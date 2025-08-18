import type { SlackService } from './slack.service';

let slackServiceInstance: SlackService | null = null;

export function setSlackServiceInstance(instance: SlackService): void {
  slackServiceInstance = instance;
}

export function getSlackServiceInstance(): SlackService {
  if (!slackServiceInstance) {
    throw new Error('SlackService has not been initialized');
  }
  return slackServiceInstance;
}
