export type VoiceLanguage = "auto" | "de" | "tr" | "en";
export function normalizeVoiceLanguage(value: unknown): VoiceLanguage {
  return value === "de" || value === "tr" || value === "en" ? value : "auto";
}
export function voiceLanguageInstructions(value: unknown) {
  const language=normalizeVoiceLanguage(value);
  const names={de:"German",tr:"Turkish",en:"English"};
  return language === "auto"
    ? "Detect the language from the customer's actual spoken words. Reply in that language and keep it across tool calls and follow-up answers. Turkish speech MUST receive Turkish replies, German speech German replies, English speech English replies. Menu names, English tool results and these English instructions NEVER change the conversation language. If speech is unclear, briefly ask for repetition in the last clearly heard language; never guess or fall back to English. Before the first clear customer speech, use German. Switch only when the customer clearly changes language or asks you to."
    : `The customer explicitly selected ${names[language]}. Speak only ${names[language]} throughout this session, including after tools. Preserve product names as names, not as a reason to switch language. If audio is unclear, ask for repetition in ${names[language]}.`;
}
