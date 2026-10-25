import { Events } from "discord.js";
import { createLogger } from "../../../core/logger.js";
import { adaptIncomingMessage } from "../adapter.js";

const logger = createLogger("Discord:MessageUpdate");

export default {
  name: Events.MessageUpdate,
  async execute(_oldMessage, newMessage, { messageHandler }) {
    try {
      await messageHandler.handle(adaptIncomingMessage(newMessage, "UPDATE"));
    } catch (error) {
      logger.error(
        {
          event: "platform.message_update.failed",
          err: error,
          platformMessageId: newMessage.id,
        },
        "Message update failed",
      );
    }
  },
};
