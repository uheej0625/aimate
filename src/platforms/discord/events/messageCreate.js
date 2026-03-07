import { Events } from "discord.js";
import { adaptMessage } from "../adapter.js";

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    const adapted = adaptMessage(message);
    await client.services.messageHandler.handle(adapted);
  },
};
