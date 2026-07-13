import type { Metadata } from "next";
import { ContentLibrary } from "@/components/content-library";

export const metadata: Metadata = { title: "Content Library" };
export default function ContentPage() { return <ContentLibrary />; }
