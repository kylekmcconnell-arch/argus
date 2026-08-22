const PROFILE_PHOTOS: Readonly<Record<string, string>> = {
  enigma: "/referral-avatars/enigma.jpg",
  kyle: "/referral-avatars/kyle.png",
  kylemcconnell: "/referral-avatars/kyle.png",
};

function profileKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function profilePhotoForName(name: string): string | null {
  return PROFILE_PHOTOS[profileKey(name)] ?? null;
}
