import Handlebars from "handlebars";

export const HandlebarsRenderer = {
  render(template, data) {
    if (!template) return "";
    const compiled = Handlebars.compile(template);
    return compiled(data);
  },
};
