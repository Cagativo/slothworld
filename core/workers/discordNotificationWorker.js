import { AttachmentBuilder } from 'discord.js';
import { assertSideEffectExecutionContext } from '../engine/enforcementRuntime.js';

export function createDiscordNotificationWorker({ getDiscordClient, emitEvent }) {
  function emitNotificationEvent(eventType, taskId, payload) {
    if (typeof emitEvent !== 'function') {
      return;
    }

    try {
      emitEvent({
        event: eventType,
        taskId: String(taskId || 'unknown'),
        timestamp: Date.now(),
        payload: payload && typeof payload === 'object' ? payload : {}
      });
    } catch (_) {
      // Non-lifecycle event emission must never throw or affect ACK
    }
  }

  return {
    async notifyTaskCompletion(task) {
      assertSideEffectExecutionContext();

      const taskId = task && task.id ? task.id : 'unknown';
      const discordClient = typeof getDiscordClient === 'function' ? getDiscordClient() : null;
      const { channelId, messageId, content: taskContent } = task && task.payload ? task.payload : {};

      // Case 1 — Missing channelId: no routing target available
      if (!channelId) {
        console.log('[DISCORD_NOTIFICATION_SKIPPED]', {
          taskId,
          reason: 'missing_channelId'
        });
        emitNotificationEvent('TASK_NOTIFICATION_SKIPPED', taskId, { reason: 'missing_channelId' });
        return null;
      }

      // Case 2 — Discord client not configured
      if (!discordClient) {
        console.log('[DISCORD_NOTIFICATION_SKIPPED]', {
          taskId,
          channelId,
          reason: 'client_not_configured'
        });
        emitNotificationEvent('TASK_NOTIFICATION_SKIPPED', taskId, { reason: 'client_not_configured', channelId });
        return null;
      }

      // Case 3 — Discord client not ready
      if (!discordClient.isReady || !discordClient.isReady()) {
        console.log('[DISCORD_NOTIFICATION_SKIPPED]', {
          taskId,
          channelId,
          reason: 'client_not_ready'
        });
        emitNotificationEvent('TASK_NOTIFICATION_SKIPPED', taskId, { reason: 'client_not_ready', channelId });
        return null;
      }

      // Case 4 — messageId absent; will send to channel instead of replying
      if (!messageId) {
        console.log('[DISCORD_NOTIFICATION_FALLBACK_CHANNEL]', {
          taskId,
          channelId
        });
      }

      // Fetch channel — explicit failure logging
      let channel;
      try {
        channel = await discordClient.channels.fetch(channelId);
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        console.error('[DISCORD_NOTIFICATION_FAILED]', {
          taskId,
          reason: 'channel_fetch_failed',
          channelId,
          error: errorMessage
        });
        emitNotificationEvent('TASK_NOTIFICATION_FAILED', taskId, {
          reason: 'channel_fetch_failed',
          channelId,
          error: errorMessage
        });
        return false;
      }

      if (!channel) {
        console.error('[DISCORD_NOTIFICATION_FAILED]', {
          taskId,
          reason: 'channel_not_found',
          channelId
        });
        emitNotificationEvent('TASK_NOTIFICATION_FAILED', taskId, {
          reason: 'channel_not_found',
          channelId
        });
        return false;
      }

      // Permission check for guild text channels
      if (channel.guild && discordClient.user && typeof channel.permissionsFor === 'function') {
        const perms = channel.permissionsFor(discordClient.user);
        if (perms && !perms.has('SendMessages')) {
          console.error('[DISCORD_NOTIFICATION_FAILED]', {
            taskId,
            reason: 'missing_send_permission',
            channelId
          });
          emitNotificationEvent('TASK_NOTIFICATION_FAILED', taskId, {
            reason: 'missing_send_permission',
            channelId
          });
          return false;
        }
      }

      // Build message content (unchanged logic)
      const executionResult = task && typeof task.executionResult === 'object' && task.executionResult !== null
        ? task.executionResult
        : {};
      const executionPayload = executionResult && typeof executionResult.result === 'object' && executionResult.result !== null
        ? executionResult.result
        : executionResult;
      const imageBase64 = typeof executionPayload.imageBase64 === 'string'
        ? executionPayload.imageBase64
        : (typeof executionPayload.contentBase64 === 'string' ? executionPayload.contentBase64 : '');
      const imageMimeType = typeof executionPayload.mimeType === 'string' ? executionPayload.mimeType : 'image/png';
      const imageUrl = typeof executionPayload.imageUrl === 'string'
        ? executionPayload.imageUrl
        : (typeof executionPayload.url === 'string' ? executionPayload.url : null);
      const files = [];

      if (imageBase64) {
        const extension = imageMimeType.includes('jpeg') || imageMimeType.includes('jpg')
          ? 'jpg'
          : (imageMimeType.includes('webp') ? 'webp' : 'png');
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        files.push(new AttachmentBuilder(imageBuffer, { name: `${taskId}.${extension}` }));
      }

      const completionMsg = {
        taskId,
        type: task.type,
        title: task.title,
        status: task.status,
        durationMs: task.durationMs || 0,
        error: task.lastError || null,
        content: typeof taskContent === 'string' ? taskContent : null,
        hasGeneratedImage: files.length > 0,
        imageUrl: imageUrl || null
      };
      const suffix = imageUrl ? `\nImage URL: ${imageUrl}` : '';
      const messageContent = `**Task Completed**\n\`\`\`json\n${JSON.stringify(completionMsg, null, 2).slice(0, 1700)}\n\`\`\`${suffix}`;

      // Attempt reply if messageId is present
      if (messageId) {
        try {
          const originalMessage = await channel.messages.fetch(messageId);
          const sent = await originalMessage.reply(files.length > 0 ? { content: messageContent, files } : messageContent);
          console.log('[DISCORD_NOTIFICATION_SENT]', {
            taskId,
            mode: 'reply',
            channelId,
            messageId,
            sentMessageId: sent && sent.id ? sent.id : null
          });
          emitNotificationEvent('TASK_NOTIFICATION_SENT', taskId, {
            mode: 'reply',
            channelId,
            messageId,
            sentMessageId: sent && sent.id ? sent.id : null
          });
          return true;
        } catch (replyError) {
          const replyErrorMsg = replyError instanceof Error ? replyError.message : String(replyError);
          console.warn('[DISCORD_NOTIFICATION_REPLY_FALLBACK]', {
            taskId,
            channelId,
            messageId,
            error: replyErrorMsg
          });
          // Fall through to channel send
        }
      }

      // Channel send (primary when no messageId, fallback when reply fails)
      try {
        const sent = await channel.send(files.length > 0 ? { content: messageContent, files } : messageContent);
        console.log('[DISCORD_NOTIFICATION_SENT]', {
          taskId,
          mode: 'channel',
          channelId,
          sentMessageId: sent && sent.id ? sent.id : null
        });
        emitNotificationEvent('TASK_NOTIFICATION_SENT', taskId, {
          mode: 'channel',
          channelId,
          sentMessageId: sent && sent.id ? sent.id : null
        });
        return true;
      } catch (sendError) {
        const sendErrorMsg = sendError instanceof Error ? sendError.message : String(sendError);
        console.error('[DISCORD_NOTIFICATION_FAILED]', {
          taskId,
          reason: 'send_failed',
          channelId,
          error: sendErrorMsg
        });
        emitNotificationEvent('TASK_NOTIFICATION_FAILED', taskId, {
          reason: 'send_failed',
          channelId,
          error: sendErrorMsg
        });
        return false;
      }
    }
  };
}
