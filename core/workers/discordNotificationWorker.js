import { AttachmentBuilder } from 'discord.js';
import { assertSideEffectExecutionContext } from '../engine/enforcementRuntime.js';

export function createDiscordNotificationWorker({ getDiscordClient }) {
  return {
    async notifyTaskCompletion(task) {
      assertSideEffectExecutionContext();

      const discordClient = typeof getDiscordClient === 'function' ? getDiscordClient() : null;
      const { channelId, messageId, content: taskContent } = task && task.payload ? task.payload : {};

      if (!channelId || !discordClient || !discordClient.isReady || !discordClient.isReady()) {
        console.log('[DISCORD]', 'completion_notification_skipped', {
          taskId: task && task.id,
          hasChannelId: !!channelId,
          clientReady: !!(discordClient && discordClient.isReady && discordClient.isReady())
        });
        return null;
      }

      try {
        const channel = await discordClient.channels.fetch(channelId);
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
          files.push(new AttachmentBuilder(imageBuffer, { name: `${task.id}.${extension}` }));
        }

        const completionMsg = {
          taskId: task.id,
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
        const content = `**Task Completed**\n\`\`\`json\n${JSON.stringify(completionMsg, null, 2).slice(0, 1700)}\n\`\`\`${suffix}`;

        if (messageId) {
          try {
            const originalMessage = await channel.messages.fetch(messageId);
            const sent = await originalMessage.reply(files.length > 0 ? { content, files } : content);
            console.log('[DISCORD]', 'completion_notification_sent', {
              taskId: task.id,
              mode: 'reply',
              channelId,
              messageId,
              sentMessageId: sent && sent.id ? sent.id : null
            });
            return true;
          } catch (replyError) {
            console.warn('[DISCORD]', 'completion_reply_failed_fallback_send', task.id, replyError.message);
          }
        }

        const sent = await channel.send(files.length > 0 ? { content, files } : content);
        console.log('[DISCORD]', 'completion_notification_sent', {
          taskId: task.id,
          mode: 'channel',
          channelId,
          sentMessageId: sent && sent.id ? sent.id : null
        });
        return true;
      } catch (error) {
        console.warn('[DISCORD]', 'completion_notification_failed', task.id, error.message);
        return false;
      }
    }
  };
}
