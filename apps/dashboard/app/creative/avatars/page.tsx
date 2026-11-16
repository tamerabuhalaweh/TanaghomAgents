import {creativeLocale} from '@/lib/creative-locale';
import {PresenterView} from '@/components/creative/presenter-view';
export default async function Page(){const {locale,dir}=await creativeLocale();return <><PresenterView locale={locale} dir={dir} management={true}/></>;}
