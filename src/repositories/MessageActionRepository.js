import { prisma } from "../database/client.js";

/** Claims an action before dispatch; an unfinished receipt must never be resent. */
export class MessageActionRepository {
  async claim(generationId, key) {
    try {
      const receipt = await prisma.messageAction.create({
        data: { generationId, key },
      });
      return { receipt, claimed: true };
    } catch (error) {
      if (error.code !== "P2002") throw error;
      const receipt = await prisma.messageAction.findUniqueOrThrow({
        where: { generationId_key: { generationId, key } },
      });
      return { receipt, claimed: false };
    }
  }

  async recordResult(id, result) {
    await prisma.messageAction.update({
      where: { id },
      data: { resultJson: JSON.stringify(result) },
    });
  }
}
