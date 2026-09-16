import { Events } from "discord.js";
import { adaptMessageDeletion } from "../adapter.js";

export default {
  name: Events.MessageDelete,
  async execute(message, { messageHandler }) {
    await messageHandler.handleDelete(
      adaptMessageDeletion([message], message.channel),
    );
  },
};
