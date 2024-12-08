import { TopbarLayout } from "@/components/TopbarLayout";

export const dynamic = "force-static";

export default function Home() {
  return (
    <TopbarLayout
      title={"Home"}
      buttons={[
        {
          type: "link",
          text: "⚙️ ",
          href: "/settings",
        },
        {
          type: "button",
          text: "😵",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      <p className="text-bold">Loading</p>
    </TopbarLayout>
  );
}
