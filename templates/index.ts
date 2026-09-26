import { classicTemplate } from "./classic";
import { minimalTemplate } from "./minimal";
import { tonkicTemplate } from "./tonkic";
import { fashionTemplate } from "./fashion";
import { luxuryTemplate } from "./luxury";
import { atelierTemplate } from "./atelier";
import { atlasTemplate } from "./atlas";
import { pearlTemplate } from "./pearl";
import { dropTemplate } from "./drop";
import { kineticTemplate } from "./kinetic";
import { mirageTemplate } from "./mirage";
import { museTemplate } from "./muse";
import { normalizeTemplateId, type TemplateId } from "./meta";
import type { Template } from "./types";

const templates: Record<TemplateId, Template> = {
  minimal: minimalTemplate,
  classic: classicTemplate,
  tonkic: tonkicTemplate,
  fashion: fashionTemplate,
  luxury: luxuryTemplate,
  atelier: atelierTemplate,
  atlas: atlasTemplate,
  pearl: pearlTemplate,
  drop: dropTemplate,
  kinetic: kineticTemplate,
  mirage: mirageTemplate,
  muse: museTemplate,
};

/** Unknown/legacy template ids fall back to the default template. */
export function getTemplate(templateId: string): Template {
  return templates[normalizeTemplateId(templateId)];
}
