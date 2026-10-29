// Formulaire de contact : titre et explication via les réglages standard ; le formulaire est une section d'accueil et une page (si le module en propose une).
export default async function contactForm(h) {
  await h.set("contact-form", "notify", false);
}
