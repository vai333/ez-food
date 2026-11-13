/**
 * Banned-ingredient ontology (build prompt §3.2). Code, not prompts, enforces these.
 * Matching is whole-word, case-insensitive, on ingredient names AND step text.
 */

export type BanRule = "nightshade" | "capsicum" | "high_fat" | "fat_method" | "ambiguous" | "sugar";

export type BannedEntry = {
  canonical: string;
  aliases: string[];
  rule: BanRule;
  reason: string;
  /** Only enforced when the user's strictCapsicum flag is on (default on). */
  strictOnly?: boolean;
};

export const BANNED: BannedEntry[] = [
  // Nightshades named in the plan
  { canonical: "tomato", aliases: ["tomato", "tomatoes", "tamatar", "tomato puree", "tomato paste", "ketchup", "tomato sauce", "passata", "cherry tomato", "sun-dried tomato"], rule: "nightshade", reason: "Tomatoes are a nightshade and are on your avoid list." },
  { canonical: "potato", aliases: ["potato", "potatoes", "aloo", "alu", "potato starch", "chips", "fries", "french fries", "hash brown", "wafers", "potato wedges"], rule: "nightshade", reason: "Potatoes are a nightshade and are on your avoid list." },
  { canonical: "brinjal", aliases: ["brinjal", "eggplant", "baingan", "baigan", "aubergine", "bharta"], rule: "nightshade", reason: "Brinjal is a nightshade and is on your avoid list." },
  { canonical: "bell pepper", aliases: ["bell pepper", "bell peppers", "capsicum", "shimla mirch", "red pepper", "green pepper", "yellow pepper", "sweet pepper"], rule: "nightshade", reason: "Bell pepper (capsicum) is a nightshade and is on your avoid list." },
  { canonical: "goji berry", aliases: ["goji", "goji berry", "goji berries", "wolfberry"], rule: "nightshade", reason: "Goji berries are a nightshade." },
  { canonical: "ashwagandha", aliases: ["ashwagandha"], rule: "nightshade", reason: "Ashwagandha is a nightshade-family herb." },
  { canonical: "tomatillo", aliases: ["tomatillo", "tomatillos"], rule: "nightshade", reason: "Tomatillo is a nightshade." },
  { canonical: "pimento", aliases: ["pimento", "pimiento"], rule: "nightshade", reason: "Pimento is a capsicum pepper." },
  // All Capsicum chillies (strict default, Q1)
  { canonical: "chilli", aliases: ["chilli", "chillies", "chili", "chilies", "chile", "chiles", "mirch", "mirchi", "green chilli", "red chilli", "green chili", "red chili", "hari mirch", "lal mirch", "chilli powder", "chili powder", "chilli flakes", "chili flakes", "red chilli flakes", "kashmiri chilli", "kashmiri mirch", "jalapeno", "jalapeño", "habanero", "bird's eye"], rule: "capsicum", reason: "Chillies come from the capsicum family, so they are off your list. Heat here comes from black pepper and ginger.", strictOnly: true },
  { canonical: "cayenne", aliases: ["cayenne", "cayenne pepper"], rule: "capsicum", reason: "Cayenne is a chilli.", strictOnly: true },
  { canonical: "paprika", aliases: ["paprika", "smoked paprika", "degi mirch"], rule: "capsicum", reason: "Paprika is ground capsicum.", strictOnly: true },
  { canonical: "hot sauce", aliases: ["hot sauce", "chilli sauce", "chili sauce", "sriracha", "tabasco", "schezwan", "szechuan sauce", "peri peri", "piri piri"], rule: "capsicum", reason: "Hot sauces are made from chillies.", strictOnly: true },
  // Spice blends that usually contain chilli: fail closed
  { canonical: "garam masala", aliases: ["garam masala"], rule: "ambiguous", reason: "Most garam masala blends contain chilli. Use cumin, black pepper and ginger instead." },
  { canonical: "curry powder", aliases: ["curry powder", "curry masala"], rule: "ambiguous", reason: "Commercial curry powder usually contains chilli." },
  { canonical: "chaat masala (store)", aliases: ["chaat masala", "store-bought masala", "store bought masala", "mixed spice", "masala mix", "sabzi masala", "pav bhaji masala", "sambar powder", "rasam powder", "kitchen king"], rule: "ambiguous", reason: "Store spice blends often hide chilli. Use the chilli-free chaat spice (roasted cumin + black salt + black pepper + dry mango)." },
  // Fat violators
  { canonical: "deep frying", aliases: ["deep fry", "deep-fry", "deep fried", "deep-fried", "fried in oil", "pakora", "pakoda", "bhajji", "bhaji", "puri", "poori", "bhatura", "samosa", "kachori", "vada", "fritter", "fritters", "tempura"], rule: "fat_method", reason: "Deep-fried food is hard on a recovering liver, so it is off the plan." },
  { canonical: "cream", aliases: ["cream", "fresh cream", "heavy cream", "malai", "sour cream", "whipped cream", "mayonnaise", "mayo"], rule: "high_fat", reason: "Cream and mayonnaise are high in fat." },
  { canonical: "butter", aliases: ["butter", "makhan", "makkhan", "margarine"], rule: "high_fat", reason: "Butter is off the plan; use up to 1 tsp ghee, mustard or cold-pressed coconut oil." },
  { canonical: "refined oil", aliases: ["refined oil", "vegetable oil", "sunflower oil", "soybean oil", "palm oil", "vanaspati", "dalda", "hydrogenated"], rule: "high_fat", reason: "Only ghee, mustard oil or cold-pressed coconut oil, and only a little." },
  { canonical: "coconut milk", aliases: ["coconut milk", "coconut cream"], rule: "high_fat", reason: "Coconut-milk gravies are high in fat." },
  { canonical: "paneer gravy", aliases: ["paneer butter masala", "shahi paneer", "paneer makhani", "cheese", "processed cheese"], rule: "high_fat", reason: "Rich paneer and cheese dishes are high in fat." },
  { canonical: "added sugar", aliases: ["sugar", "jaggery syrup", "honey", "condensed milk", "syrup", "sweetener"], rule: "sugar", reason: "The plan has no added sugar; sweetness comes from fruit." },
];

/** Allowed cooking fats and the hard cap (build prompt §3.1). */
export const ALLOWED_FATS = ["ghee", "mustard oil", "coconut oil", "cold-pressed coconut oil"];
export const MAX_ADDED_FAT_TSP_PER_MEAL = 1;

/** Only these may be consumed outside the eating window. */
export const FASTING_ALLOWED = ["water", "plain water", "warm water", "green tea", "black coffee", "ginger-turmeric water"];

/** Words that may appear inside a safe phrase and must not trigger a ban (e.g. "black pepper" is fine). */
export const SAFE_PHRASES = [
  "black pepper",
  "white pepper",
  "peppercorn",
  "peppercorns",
  "pepper-free",
  "chilli-free",
  "chili-free",
  "no chilli",
  "no chili",
  "no tomato",
  "no potato",
  "no capsicum",
  "without chilli",
  "without tomato",
  "without potato",
  "sweet potato", // not a nightshade (Convolvulaceae)
  "chilli-free chaat spice",
  "coconut water",
  "butter milk",
  "buttermilk",
  "pepper-mustard",
  "no sugar",
  "without sugar",
  "no added sugar",
  "sugar-free",
  "no butter",
  "no cream",
  "no oil",
  "ginger-pepper",
];
