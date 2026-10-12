import fs from "fs/promises";
import Handlebars from "handlebars";

export const renderTemplate = (template, context = {}) => {
  if (!template) return "";

  const compiled = Handlebars.compile(template, { noEscape: true });
  return compiled(context);
};

export const renderTemplateFile = async (filePath, context = {}) => {
  const template = await fs.readFile(filePath, "utf-8");
  return renderTemplate(template, context);
};
