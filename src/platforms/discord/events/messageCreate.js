import { Events } from "discord.js";
import { adaptMessage } from "../adapter.js";

export default {
  name: Events.MessageCreate,
  async execute(message, { messageHandler }) {
    const adapted = adaptMessage(message);
    await messageHandler.handle(adapted);
  },
};
