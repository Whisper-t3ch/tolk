import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeTimeZone } from "@/lib/timezone";
import { readProfile, readServices, readReviews } from "@/lib/bookingProfile";

// GET /api/public/booking/[slug]/info — витрина специалиста для публичной страницы записи:
// имя, профиль (фото, о себе, ссылки, квалификация, цвет), услуги, отзывы, часовой пояс.
// Публичный роут без авторизации; отдаёт только то, что психолог сам заполнил для страницы записи.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = createAdminClient();

  const { data: settings, error } = await supabase
    .from("booking_settings")
    .select("psychologist_id, session_duration_minutes, is_active, profile, services, reviews")
    .eq("public_slug", slug)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!settings || !settings.is_active) {
    return NextResponse.json({ error: "Страница бронирования не найдена" }, { status: 404 });
  }

  let name = "Психолог";
  const { data: authUser } = await supabase.auth.admin.getUserById(settings.psychologist_id);
  const metadataName = typeof authUser?.user?.user_metadata?.name === "string" ? authUser.user.user_metadata.name.trim() : "";
  if (metadataName) name = metadataName;

  const { data: profileRow } = await supabase
    .from("psychologists")
    .select("specialty, timezone")
    .eq("id", settings.psychologist_id)
    .maybeSingle();

  return NextResponse.json(
    {
      name,
      specialty: profileRow?.specialty ?? null,
      timezone: normalizeTimeZone(profileRow?.timezone as string | undefined),
      default_duration_minutes: settings.session_duration_minutes,
      profile: readProfile(settings.profile),
      services: readServices(settings.services),
      reviews: readReviews(settings.reviews),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
