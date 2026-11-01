/**
 * Extensions, et par-dessus, les réglages d'une extension en fenêtre quand on y arrive depuis la liste (route interceptée, voir @modal). Les adresses
 * /admin/instances/<id> et /admin/modules/<id> restent de vraies pages : ouvertes directement, rafraîchies ou depuis le menu d'admin, elles s'affichent en page entière.
 */
export default function ExtensionsLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return <>{children}{modal}</>;
}
