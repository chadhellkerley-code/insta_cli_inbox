/**
 * Configuration model for storing stages, follow‑ups and AI prompts. All data
 * is stored in Supabase under the `stages` table keyed by the owner/user id.
 */

/**
 * Create or update a stage definition for a user. If an id is provided the
 * existing stage is updated; otherwise a new stage is inserted.
 *
 * @param {Object} supabase - Supabase client
 * @param {string} userId - owner of the stage
 * @param {Object} stage - stage definition: { id?, name, messages, delay, followUps, aiPrompt, followupHours }
 */
async function upsertStage(supabase, userId, stage) {
  const payload = {
    id: stage.id || undefined,
    user_id: userId,
    name: stage.name,
    messages: stage.messages || [],
    delay: stage.delay || 0,
    follow_ups: stage.followUps || [],
    ai_prompt: stage.aiPrompt || null,
    followup_hours: stage.followupHours || [],
  };
  const { data, error } = await supabase.from('stages').upsert(payload);
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/**
 * List all stages for a given user.
 */
async function listStages(supabase, userId) {
  const { data, error } = await supabase.from('stages').select('*').eq('user_id', userId).order('id', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data || [];
}

module.exports = {
  upsertStage,
  listStages,
};