import crypto from "node:crypto";

/** Règle commune à tous les endroits où l'on choisit un mot de passe (assistant d'installation, nouvel utilisateur, Mon compte, mot de passe personnel forcé). */
export const MIN_PASSWORD_LENGTH = 10;

/** `null` si le mot de passe convient, sinon la raison. */
export function passwordProblem(password: string): "short" | null {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH ? null : "short";
}

/** Sans caractères qui se confondent à la lecture ou à la dictée : ni 0/O, ni 1/l/I. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const GROUPS = 4;
const GROUP_SIZE = 4;

/**
 * Mot de passe temporaire : 16 caractères tirés au hasard (générateur cryptographique, tirage sans biais) parmi 56 lisibles, présentés par groupes de 4
 * (`Xk7m-Qp2w-Rt9b-Hn4c`), soit environ 93 bits : bien au-delà de ce qu'on peut deviner. Contient toujours une minuscule, une majuscule et un chiffre.
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    const groups: string[] = [];
    for (let g = 0; g < GROUPS; g++) {
      let part = "";
      for (let i = 0; i < GROUP_SIZE; i++) part += ALPHABET[crypto.randomInt(ALPHABET.length)];
      groups.push(part);
    }
    const password = groups.join("-");
    if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /[2-9]/.test(password)) return password;
  }
}
