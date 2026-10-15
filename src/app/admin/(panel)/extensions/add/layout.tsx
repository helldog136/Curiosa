/** Le catalogue, et par-dessus, la fiche d'un module en fenêtre quand on y arrive depuis le catalogue (route interceptée, voir @modal). */
export default function CatalogueLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return <>{children}{modal}</>;
}
