export function parseCommandInput(inputString) {
  const input = String(inputString || '').trim();
  if (!input) {
    return { success: false, error: 'empty_command' };
  }

  const injectMatch = input.match(/^inject\s+(discord|shopify)\s+"([\s\S]+)"$/i);
  if (injectMatch) {
    return {
      success: true,
      command: 'inject',
      type: injectMatch[1].toLowerCase(),
      message: injectMatch[2]
    };
  }

  const spawnWorkflowMatch = input.match(/^spawn\s+workflow\s+product\s+(.+)$/i);
  if (spawnWorkflowMatch) {
    return {
      success: true,
      command: 'spawn_workflow_product',
      keyword: spawnWorkflowMatch[1].trim()
    };
  }

  const inspectAgentMatch = input.match(/^inspect\s+agent\s+(\d+)$/i);
  if (inspectAgentMatch) {
    return { success: true, command: 'inspect_agent', agentId: Number(inspectAgentMatch[1]) };
  }

  const pauseDeskMatch = input.match(/^pause\s+desk\s+(\d+)$/i);
  if (pauseDeskMatch) {
    return { success: true, command: 'pause_desk', deskId: Number(pauseDeskMatch[1]) };
  }

  const resumeDeskMatch = input.match(/^resume\s+desk\s+(\d+)$/i);
  if (resumeDeskMatch) {
    return { success: true, command: 'resume_desk', deskId: Number(resumeDeskMatch[1]) };
  }

  const inspectDeskMatch = input.match(/^inspect\s+desk\s+(\d+)$/i);
  if (inspectDeskMatch) {
    return { success: true, command: 'inspect_desk', deskId: Number(inspectDeskMatch[1]) };
  }

  const inspectWorkflowMatch = input.match(/^inspect\s+workflow\s+(.+)$/i);
  if (inspectWorkflowMatch) {
    return { success: true, command: 'inspect_workflow', workflowId: inspectWorkflowMatch[1].trim() };
  }

  const approveWorkflowMatch = input.match(/^approve\s+workflow\s+(.+)$/i);
  if (approveWorkflowMatch) {
    return { success: true, command: 'approve_workflow', workflowId: approveWorkflowMatch[1].trim() };
  }

  const rejectWorkflowMatch = input.match(/^reject\s+workflow\s+(.+?)(?:\s+(.+))?$/i);
  if (rejectWorkflowMatch) {
    return {
      success: true,
      command: 'reject_workflow',
      workflowId: rejectWorkflowMatch[1].trim(),
      reason: rejectWorkflowMatch[2] ? rejectWorkflowMatch[2].trim() : null
    };
  }

  return { success: false, error: 'unknown_command' };
}
