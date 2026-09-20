import { Events } from "discord.js";
import { adaptMessageDeletion } from "../adapter.js";

export default {
  name: Events.MessageDelete,
  async execute(message, { messageHandler }) {
    await messageHandler.handle(
      adaptMessageDeletion([message], message.channel),
    );
  },
};
