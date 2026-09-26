import FamilyRequestForm from "./FamilyRequestForm";

export const metadata = { title: "Ruvanas Inside radio request" };

export default async function InsideFamilyRequestPage({ params }) {
  const { code } = await params;
  return <FamilyRequestForm code={typeof code === "string" ? code : ""} />;
}
