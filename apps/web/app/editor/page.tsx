import { redirect } from 'next/navigation';

export default function LegacyEditorRedirect() {
  redirect('/admin/map');
}
