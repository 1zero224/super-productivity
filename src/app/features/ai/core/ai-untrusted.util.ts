/** Marks user-authored text so the model treats it as data, never as instructions. */
export const wrapUntrusted = (text: string): string =>
  `<untrusted_user_content>${text}</untrusted_user_content>`;
