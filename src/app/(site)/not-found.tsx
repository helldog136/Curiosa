import { getVisitorTranslator } from "@/core/i18n/request";

export default async function NotFound() {
  const t = await getVisitorTranslator();
  return (
    <div className="space-y-4 py-16 text-center">
      <h1 data-skin-part="heading" data-level="1" className="text-4xl font-bold">404</h1>
      <p data-skin-part="lead" className="text-muted">{t("site.notFound")}</p>
      <a href="/" data-skin-part="link" className="text-accent hover:underline">{t("site.backHome")}</a>
    </div>
  );
}
