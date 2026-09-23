import { Events } from "discord.js";
import { adaptMessageDeletion } from "../adapter.js";

export default {
  name: Events.MessageBulkDelete,
  async execute(messages, channel, { messageHandler }) {
    await messageHandler.handle(
      adaptMessageDeletion(messages.values(), channel),
    );
  },
};
