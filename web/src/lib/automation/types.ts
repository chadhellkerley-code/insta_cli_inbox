export type AutomationAgentRecord = {
  id: string;
  owner_id: string;
  name: string;
  personality: string | null;
  min_reply_delay_seconds: number;
  max_reply_delay_seconds: number;
  max_media_per_chat: number;
  is_active: boolean;
  ai_enabled: boolean;
  ai_prompt: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AutomationStageRecord = {
  id: string;
  owner_id: string;
  agent_id: string;
  stage_order: number;
  name: string;
  followup_enabled: boolean;
  followup_delay_minutes: number;
  followup_message: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AutomationStageMessageRecord = {
  id: string;
  owner_id: string;
  stage_id: string;
  message_order: number;
  message_type: "text" | "audio";
  text_content: string | null;
  media_url: string | null;
  delay_seconds: number;
  created_at: string | null;
  updated_at: string | null;
};

export type AutomationStageMessageInput = {
  id?: string;
  messageType: "text" | "audio";
  textContent: string;
  mediaUrl: string;
  delaySeconds: number;
};

export type AutomationStageInput = {
  id?: string;
  name: string;
  followupEnabled: boolean;
  followupDelayMinutes: number;
  followupMessage: string;
  messages: AutomationStageMessageInput[];
};

export type AutomationAgentInput = {
  id?: string;
  name: string;
  personality: string;
  minReplyDelaySeconds: number;
  maxReplyDelaySeconds: number;
  maxMediaPerChat: number;
  isActive: boolean;
  aiEnabled: boolean;
  aiPrompt: string;
  stages: AutomationStageInput[];
};

export type AutomationAgent = {
  id: string;
  name: string;
  personality: string;
  minReplyDelaySeconds: number;
  maxReplyDelaySeconds: number;
  maxMediaPerChat: number;
  isActive: boolean;
  aiEnabled: boolean;
  aiPrompt: string;
  createdAt: string | null;
  updatedAt: string | null;
  stages: Array<{
    id: string;
    name: string;
    order: number;
    followupEnabled: boolean;
    followupDelayMinutes: number;
    followupMessage: string;
    messages: Array<{
      id: string;
      order: number;
      messageType: "text" | "audio";
      textContent: string;
      mediaUrl: string;
      delaySeconds: number;
    }>;
  }>;
};

export type LocalAgentAiConfig = {
  apiKey: string;
};

export const DEFAULT_AGENT_NAME = "Agente nuevo";

export function createEmptyAgentDraft(): AutomationAgentInput {
  return {
    name: DEFAULT_AGENT_NAME,
    personality: "",
    minReplyDelaySeconds: 30,
    maxReplyDelaySeconds: 90,
    maxMediaPerChat: 1,
    isActive: false,
    aiEnabled: false,
    aiPrompt: "",
    stages: [
      {
        name: "Etapa 1",
        followupEnabled: false,
        followupDelayMinutes: 120,
        followupMessage: "",
        messages: [
          {
            messageType: "text",
            textContent: "Hola, gracias por escribirnos.",
            mediaUrl: "",
            delaySeconds: 0,
          },
        ],
      },
    ],
  };
}

export function getAgentStatusLabel(agent: Pick<AutomationAgent, "isActive">) {
  return agent.isActive ? "Activo" : "Inactivo";
}
