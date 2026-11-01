export const feedPath = (locale) => (locale === "fr" ? "/rss.xml" : `/${locale}/rss.xml`);
export const hasFeedSource = async () => true;
