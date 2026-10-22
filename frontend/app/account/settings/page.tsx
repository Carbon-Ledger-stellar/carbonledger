import { redirect } from "next/navigation";

export default function AccountSettingsIndex() {
  redirect("/account/settings/profile");
}