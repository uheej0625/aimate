import { Events } from "discord.js";
import { adaptIncomingMessage } from "../adapter.js";

export default {
  name: Events.MessageCreate,
  async execute(message, { messageHandler }) {
    await messageHandler.handle(adaptIncomingMessage(message));
  },
};
