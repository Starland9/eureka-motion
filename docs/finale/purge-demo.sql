-- Retire du cache les explications de la gravitation en français, niveau Lycée, pour que la démo
-- génère en direct. Les explications restent en base : leurs liens de partage marchent toujours.

SELECT 'question_cache' AS cache, count(*) AS lignes
FROM question_cache q
JOIN explanations e ON e.id = q.explanation_id
WHERE q.language = 'fr' AND q.level = 'lycee'
  AND (e.question ILIKE '%gravit%' OR e.concept_slug ILIKE '%gravit%')
UNION ALL
SELECT 'concept_cache', count(*)
FROM concept_cache
WHERE language = 'fr' AND level = 'lycee' AND concept_slug ILIKE '%gravit%';

BEGIN;

DELETE FROM question_cache q
USING explanations e
WHERE e.id = q.explanation_id
  AND q.language = 'fr' AND q.level = 'lycee'
  AND (e.question ILIKE '%gravit%' OR e.concept_slug ILIKE '%gravit%');

DELETE FROM concept_cache
WHERE language = 'fr' AND level = 'lycee' AND concept_slug ILIKE '%gravit%';

COMMIT;

SELECT 'question_cache' AS cache, count(*) AS lignes
FROM question_cache q
JOIN explanations e ON e.id = q.explanation_id
WHERE q.language = 'fr' AND q.level = 'lycee'
  AND (e.question ILIKE '%gravit%' OR e.concept_slug ILIKE '%gravit%')
UNION ALL
SELECT 'concept_cache', count(*)
FROM concept_cache
WHERE language = 'fr' AND level = 'lycee' AND concept_slug ILIKE '%gravit%';
