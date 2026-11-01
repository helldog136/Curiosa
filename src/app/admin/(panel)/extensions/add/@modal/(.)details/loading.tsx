import { FicheLoading } from "@/components/admin/FicheLoading";

/** Dès le clic, la fenêtre s'ouvre (avant même que le site ait répondu) avec un emplacement qui dit que la fiche arrive. Rien à attendre ici : textes fournis par le client. */
export default function CatalogueDetailsModalLoading() {
  return <FicheLoading embedded />;
}
