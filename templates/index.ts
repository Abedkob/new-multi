import { boldTemplate } from "./bold";
import { classicTemplate } from "./classic";
import { minimalTemplate } from "./minimal";
import { tonkicTemplate } from "./tonkic";
import { fashionTemplate } from "./fashion";
import { luxuryTemplate } from "./luxury";
import { normalizeTemplateId, type TemplateId } from "./meta";
import type { Template } from "./types";

const templates: Record<TemplateId, Template> = {
  minimal: minimalTemplate,
  bold: boldTemplate,
  classic: classicTemplate,
  tonkic: tonkicTemplate,
  fashion: fashionTemplate,
  luxury: luxuryTemplate,
};

/** Unknown/legacy template ids fall back to the default template. */
export function getTemplate(templateId: string): Template {
  return templates[normalizeTemplateId(templateId)];
}
