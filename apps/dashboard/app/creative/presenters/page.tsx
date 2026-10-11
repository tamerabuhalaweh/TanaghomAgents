import {creativeLocale} from '@/lib/creative-locale';
import {PresenterView} from '@/components/creative/presenter-view';
import {LocaleToggle} from '@/components/creative/locale-toggle';
export default async function Page(){const {locale,dir}=await creativeLocale();return <><LocaleToggle locale={locale}/><PresenterView locale={locale} dir={dir} management={false}/></>;}
