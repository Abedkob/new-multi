-- The "bold" template was removed; stores that used it move to the default template.
UPDATE "Tenant" SET "templateId" = 'minimal' WHERE "templateId" = 'bold';
