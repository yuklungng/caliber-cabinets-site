// Display order of FAQ categories (admin list + homepage filter pills).
// To add or rename a category, edit this list; FAQs store the category name as text.
export const FAQ_CATEGORIES = [
  'Process and timing',
  'Pricing and payment',
  'Materials and construction',
  'Service and scope',
  'Trade partners',
  'About Caliber',
];

export const DEFAULT_FAQ_CATEGORY = 'About Caliber';

export function categoryIndex(name) {
  const i = FAQ_CATEGORIES.indexOf(name);
  return i === -1 ? FAQ_CATEGORIES.length : i;
}

// Category order first, then the admin-set order within a category.
export function sortFaqs(list) {
  return [...list].sort(
    (a, b) => categoryIndex(a.category) - categoryIndex(b.category) || a.sort_order - b.sort_order,
  );
}
