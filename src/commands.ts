import type { SlashCommandDef } from './types/chat';

export const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    id: 'career',
    label: 'Career Development',
    description: 'Explore growth paths, levelling, and development plans',
    icon: 'compass',
  },
  {
    id: 'feedback',
    label: 'Feedback Preparation',
    description: 'Get help writing effective feedback',
    icon: 'pencil',
  },
];
