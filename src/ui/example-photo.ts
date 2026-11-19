export function examplePhotoUrl(name: string): string {
  return `${import.meta.env.BASE_URL}examples/${name}.jpg`;
}
