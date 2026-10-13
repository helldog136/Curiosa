// Le rapport : lisible par une personne (texte) et par une IA (JSON). Ce qui a été repris, ce qui n'a pas pu l'être, ce qui est à vérifier.
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** JSON du rapport : la fiche + le bilan de la sauvegarde. Stable : pas d'horodatage, ordre des clés fixe. */
export function reportJson(profile, backup) {
  return {
    ok: !!backup?.file,
    source: profile.source,
    site: { name: profile.site.name, description: profile.site.description, avatar: profile.site.avatar, avatarImported: backup?.avatar?.status ?? "none" },
    counts: { links: profile.links.length, sections: profile.sections.length, socials: profile.socials.length, notRetained: profile.notRetained.length, duplicates: profile.duplicates.length, toCheck: profile.toCheck.length },
    retained: { links: profile.links, sections: profile.sections, socials: profile.socials.map((s) => ({ platform: s.platform, module: s.module, value: s.value })) },
    notRetained: profile.notRetained,
    duplicates: profile.duplicates,
    toCheck: [...profile.toCheck, ...(backup?.toCheck ?? [])],
    notes: [...profile.notes, ...(backup?.notes ?? [])],
    backup: backup ? { file: backup.file, modules: backup.modules, owner: { email: backup.owner.email, name: backup.owner.name } } : null,
  };
}

/** Texte du rapport (en français, sans mot de passe : il n'est affiché qu'à l'écran). */
export function reportText(profile, backup) {
  const s = profile.source, L = [];
  const how = s.adapter === "generic" ? (s.fallback ? `lecture de secours (générique) : ${s.fallbackReason}` : "lecture générique de la page") : `lecture spécialisée « ${s.adapter} »`;
  L.push(backup?.file ? `Import depuis un agrégateur de liens → ${backup.file}` : "Lecture d'une page de liens (aucune sauvegarde produite)");
  L.push(`Source : ${s.url || s.input}${s.aggregator !== "unknown" ? ` (service reconnu : ${s.aggregator})` : " (service non reconnu)"} — ${how}`);
  L.push("", `Site : « ${profile.site.name || "(sans nom)"} »${profile.site.description ? ` — ${profile.site.description.slice(0, 120)}${profile.site.description.length > 120 ? "…" : ""}` : ""}`);
  L.push(`Avatar : ${!profile.site.avatar ? "aucun" : !backup ? "adresse trouvée (téléchargée à la création de la sauvegarde)" : ({ downloaded: "téléchargé et repris", linked: "gardé comme lien vers l'image d'origine" }[backup.avatar?.status] ?? "non repris")}`);
  L.push("", `Repris : ${plural(profile.links.length, "lien", "liens")}${profile.sections.length ? ` en ${plural(profile.sections.length, "section", "sections")} (${profile.sections.join(", ")})` : ""}, ${plural(profile.socials.length, "réseau social", "réseaux sociaux")}${profile.socials.length ? ` : ${profile.socials.map((x) => `${x.label}${x.handle ? ` (${x.handle})` : ""}`).join(", ")}` : ""}`);
  if (profile.duplicates.length) L.push(`${plural(profile.duplicates.length, "doublon ignoré", "doublons ignorés")}`);
  if (profile.notRetained.length) { L.push("", `${profile.notRetained.length} ${profile.notRetained.length > 1 ? "éléments non repris" : "élément non repris"} :`); for (const n of profile.notRetained) L.push(`  • « ${n.title} »${n.url ? ` — ${n.url}` : ""} — ${n.reason}`); }
  const check = [...profile.toCheck, ...(backup?.toCheck ?? [])];
  if (check.length) { L.push("", "À vérifier :"); for (const c of check) L.push(`  ⚠ ${c}`); } else L.push("", "Rien de particulier à vérifier.");
  const notes = [...profile.notes, ...(backup?.notes ?? [])];
  if (notes.length) { L.push("", "Notes :"); for (const n of notes) L.push(`  • ${n}`); }
  return L.join("\n") + "\n";
}
