/**
 * Feishu/Lark message event types.
 * Strictly typed to match SDK event payloads.
 */

/** Sender identity in a message event */
export interface MessageSender {
  sender_id: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  sender_type?: string;
  tenant_key?: string;
}

/** Message payload in a message event */
export interface MessagePayload {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  message_type: string;
  content: string;
  mentions?: MessageMention[];
}

/** Mention in a message */
export interface MessageMention {
  key: string;
  id: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  name: string;
  tenant_key?: string;
}

/** im.message.receive_v1 event data */
export interface MessageReceivedEvent {
  schema?: string;
  event_id?: string;
  create_time?: string;
  event_type?: string;
  tenant_key?: string;
  app_id?: string;
  sender: MessageSender;
  message: MessagePayload;
}

/** im.chat.member.bot.added_v1 event data */
export interface BotAddedEvent {
  chat_id: string;
  operator_id: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  external: boolean;
  operator_tenant_key?: string;
}

/** im.chat.member.bot.deleted_v1 event data */
export interface BotRemovedEvent {
  chat_id: string;
}

/** Event handler function type */
export type EventHandler<T> = (data: T) => Promise<void>;

/** Registered event handlers */
export interface EventHandlers {
  onMessageReceived?: EventHandler<MessageReceivedEvent>;
  onBotAdded?: EventHandler<BotAddedEvent>;
  onBotRemoved?: EventHandler<BotRemovedEvent>;
}
