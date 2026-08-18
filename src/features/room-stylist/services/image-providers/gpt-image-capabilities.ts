/**
 * Per-model capability facts for the GPT Image family.
 *
 * Deliberately its own module with NO imports: `gpt-image.ts` pulls in the
 * shared OpenAI client, which is constructed eagerly and throws when no API key
 * is present. Keeping these pure facts separate means the test suite can assert
 * them without a key, which is the whole point of having them as data.
 */

/**
 * Models that accept `input_fidelity`.
 *
 * An ALLOWLIST, not a denylist, and deliberately so: sending the parameter to a
 * model that does not take it is a hard 400 that fails the entire generation,
 * whereas omitting it on a model that would have accepted it merely costs some
 * input faithfulness. So an unrecognised id — including anything set via
 * GPT_IMAGE_MODEL — gets no `input_fidelity` at all.
 *
 * GPT Image 2 is absent on purpose. It processes image inputs at high fidelity
 * on its own and returns 400 on the parameter's mere presence:
 *   "The model 'gpt-image-2' does not support the 'input_fidelity' parameter."
 * `gpt-image-1-mini` is absent because it does not support the parameter
 * either — which is also why this matches ids EXACTLY rather than by prefix,
 * since `gpt-image-1-mini` starts with `gpt-image-1`.
 */
const MODELS_SUPPORTING_INPUT_FIDELITY = new Set([
  "gpt-image-1",
  "gpt-image-1.5",
]);

/** Does this model accept `input_fidelity`? Unknown ids are treated as "no". */
export function supportsInputFidelity(model: string): boolean {
  return MODELS_SUPPORTING_INPUT_FIDELITY.has(model.trim());
}
