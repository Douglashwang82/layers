import { db, pool, schema as s } from "./index";
import { placeCategories } from "../../shared/src";
import { ensureSystemLayers } from "./system-layers";
const uid = (group: number, n: number) =>
  `00000000-0000-4000-8000-${String(group * 1000 + n).padStart(12, "0")}`;
const photos = [
  "photo-1552611052-33e04de081de",
  "photo-1569718212165-3a8278d5f624",
  "photo-1563245372-f21724e3856d",
  "photo-1547592180-85f173990554",
  "photo-1517433670267-08bbd4be890f",
  "photo-1501339847302-ac426a4a7cbb",
];
const photo = (n: number) =>
  `https://images.unsplash.com/${photos[n % photos.length]}?auto=format&fit=crop&w=1200&q=80`;
const neighborhoods = [
  "Bellaire",
  "Chinatown",
  "Katy",
  "Sugar Land",
  "Downtown Houston",
  "Midtown",
];
async function main() {
  await db.transaction(async (tx) => {
    await tx
      .insert(s.city)
      .values({
        id: uid(1, 1),
        slug: "houston",
        name: "Houston",
        region: "TX",
        country: "USA",
        timezone: "America/Chicago",
        latitude: 29.7604,
        longitude: -95.3698,
      })
      .onConflictDoNothing();
    for (let i = 0; i < 15; i++)
      await tx
        .insert(s.user)
        .values({
          id: uid(2, i),
          name: `Demo Neighbor ${i + 1}`,
          email: `neighbor${i + 1}@demo.taiwanhub.invalid`,
          emailVerified: false,
          homeCityId: uid(1, 1),
        })
        .onConflictDoNothing();
    for (const [i, name] of placeCategories.entries())
      await tx
        .insert(s.placeCategory)
        .values({ id: uid(3, i), name })
        .onConflictDoNothing();
    const orgs = [
      "Houston Taiwanese Table",
      "Taiwanese Professionals Circle",
      "Bayou Taiwanese Students",
      "Jade Culture Collective",
      "Houston Outdoor Friends",
    ];
    for (let i = 0; i < 5; i++)
      await tx
        .insert(s.organization)
        .values({
          id: uid(4, i),
          slug: `demo-${orgs[i].toLowerCase().replaceAll(" ", "-")}`,
          name: orgs[i],
          nameChinese: [
            "休士頓台灣餐桌",
            "台灣專業人士",
            "台灣學生會",
            "翡翠文化社",
            "戶外好朋友",
          ][i],
          description:
            "A fictional Houston community group for exploring TaiwanHub. Demo profile; not an actual organization.",
          descriptionChinese: "這是 TaiwanHub 的示範社群，並非真實組織。",
          category: "Community",
          cityId: uid(1, 1),
          image: photo(i + 3),
          status: "approved",
          isDemo: true,
          source: "TaiwanHub demo seed",
        })
        .onConflictDoNothing();
    const names = [
      "Little Taipei Noodle House",
      "Jade Leaf Tea Studio",
      "Formosa Bakery",
      "Sunday Hot Pot",
      "Morning Soy Kitchen",
      "Sweet Taro House",
      "H Mart Bellaire · demo listing",
      "99 Ranch · demo listing",
      "Kumo Ramen Table",
      "Seoul Garden Kitchen",
      "Dumpling Corner",
      "Slow Day Cafe",
      "Taiwan Bento Club",
      "Pearl Milk Tea",
      "Golden Pineapple Bakery",
      "Bayou Shabu",
      "Rice Roll Breakfast",
      "Snowflake Dessert",
      "Garden Noodle Bar",
      "Night Market Kitchen",
    ];
    for (let i = 0; i < 20; i++) {
      const c = i === 7 ? 6 : i < 12 ? i : (i - 12) % 6;
      const latitude = 29.705 + (i % 5) * 0.014,
        longitude = -95.57 + (i % 7) * 0.018;
      await tx
        .insert(s.place)
        .values({
          id: uid(5, i),
          slug: `demo-${names[i]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/-$/, "")}`,
          name: names[i],
          nameChinese: [
            "小台北牛肉麵",
            "翡翠茶坊",
            "福爾摩沙烘焙",
            "週日火鍋",
            "早安豆漿",
            "芋頭甜品",
            "韓亞龍超市（示範）",
            "大華超市（示範）",
          ][i % 8],
          description:
            "A cozy neighborhood favorite in our fictional Houston guide. Gather around a table, discover a familiar flavor, and share a recommendation with the community.",
          descriptionChinese:
            "在示範休士頓指南中，與朋友圍桌而坐，品嚐熟悉的台灣味，分享你的推薦。",
          image: photo(i),
          category: placeCategories[c],
          categoryId: uid(3, c),
          aliases:
            i % 3 === 0
              ? "beef noodle 牛肉麵 Taiwanese 台灣"
              : "tea 茶 bakery 麵包",
          cityId: uid(1, 1),
          neighborhood: neighborhoods[i % 6],
          address: `${1000 + i * 10} Demo Lane, Houston, TX (fictional)`,
          latitude,
          longitude,
          location: { x: longitude, y: latitude },
          hours: "Demo hours: Tue–Sun, 11:00 AM–9:00 PM",
          priceLevel: (i % 3) + 1,
          status: "approved",
          isDemo: true,
          source: "TaiwanHub demo seed",
        })
        .onConflictDoNothing();
    }
    const saturday = new Date();
    saturday.setUTCDate(
      saturday.getUTCDate() + ((6 - saturday.getUTCDay() + 7) % 7 || 7),
    );
    saturday.setUTCHours(18, 0, 0, 0);
    const eventNames = [
      "A little taste of home",
      "Mid-Autumn under the stars",
      "Saturday pickup basketball",
      "Coffee & new connections",
      "Taiwanese board game night",
      "A walk along the bayou",
      "Dumplings with friends",
      "New in Houston? Say hello",
      "Family picnic at the park",
      "Stories from Taiwan",
    ];
    for (let i = 0; i < 10; i++) {
      const start = new Date(
        saturday.getTime() + (i % 3) * 86400000 + (i % 4) * 3600000,
      );
      await tx
        .insert(s.event)
        .values({
          id: uid(6, i),
          slug: `demo-${eventNames[i]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/-$/, "")}`,
          name: eventNames[i],
          nameChinese: [
            "家的味道",
            "星空下的中秋節",
            "週六籃球",
            "咖啡與新朋友",
            "台灣桌遊之夜",
          ][i % 5],
          description:
            "Meet your Houston neighbors over shared food and good conversation. This is a demonstration event, not a real gathering. Do not travel to the listed venue.",
          descriptionChinese:
            "和休士頓的鄰居一起分享美食與故事。這是示範活動，並非真實聚會，請勿前往。",
          image: `https://images.unsplash.com/${["photo-1511795409834-ef04bbd61622", "photo-1511632765486-a01980e01a18", "photo-1519861531473-9200262188bf"][i % 3]}?auto=format&fit=crop&w=1200&q=80`,
          category: [
            "Food",
            "Festival",
            "Sports",
            "Networking",
            "Social",
            "Outdoor",
            "Food",
            "Student",
            "Family",
            "Culture",
          ][i],
          cityId: uid(1, 1),
          neighborhood: neighborhoods[i % 6],
          address: "100 Demo Park, Houston (fictional)",
          latitude: 29.72,
          longitude: -95.48,
          location: { x: -95.48, y: 29.72 },
          organizerId: uid(4, i % 5),
          venue: "Demo Community House",
          startTime: start,
          endTime: new Date(start.getTime() + 7200000),
          capacity: 30,
          featured: i < 2,
          status: "approved",
          isDemo: true,
          source: "TaiwanHub demo seed",
        })
        .onConflictDoNothing();
    }
    const products = [
      ["I-Mei Chocolate Puffs", "義美巧克力小泡芙", "I-Mei"],
      ["Pineapple Cakes", "鳳梨酥", "Sunny Demo"],
      ["Apple Sidra", "蘋果西打", "Apple Sidra"],
      ["Black Sarsaparilla", "黑松沙士", "HeySong"],
      ["Knife-cut Noodles", "刀削麵", "Taiwan Pantry"],
      ["Milk Tea", "奶茶", "Chun Cui He"],
      ["Kuai Kuai Coconut Snacks", "乖乖椰子", "Kuai Kuai"],
      ["Scallion Pancakes", "蔥油餅", "I-Mei"],
      ["Soy Paste", "醬油膏", "Kimlan"],
      ["Science Noodles", "科學麵", "Uni-President"],
    ];
    for (let i = 0; i < 10; i++)
      await tx
        .insert(s.product)
        .values({
          id: uid(7, i),
          slug: `demo-${products[i][0].toLowerCase().replaceAll(" ", "-")}`,
          name: products[i][0],
          nameChinese: products[i][1],
          brand: products[i][2],
          category: i % 2 ? "Pantry" : "Snacks",
          aliases: `${products[i].join(" ")} 台灣 Taiwanese`,
          description:
            "A familiar taste of Taiwan. Sightings are demo reports and do not indicate current stock.",
          descriptionChinese: "熟悉的台灣味。示範目擊紀錄不代表即時庫存。",
          image: `/demo/product-${i}.svg`,
          onlineUrl: "https://www.sayweee.com/",
          status: "approved",
          isDemo: true,
          source: "TaiwanHub demo seed",
        })
        .onConflictDoNothing();
    for (let i = 0; i < 20; i++)
      await tx
        .insert(s.productSighting)
        .values({
          id: uid(8, i),
          productId: uid(7, i % 10),
          placeId: uid(5, i < 10 ? 6 : 7),
          userId: uid(2, i % 15),
          price: 3.49 + (i % 4),
          observedAt: new Date(Date.now() - ((i % 9) + 1) * 86400000),
          status: "approved",
          isDemo: true,
          source: "TaiwanHub demo seed",
        })
        .onConflictDoNothing();
    for (let i = 0; i < 50; i++)
      await tx
        .insert(s.placeRecommendation)
        .values({
          id: uid(9, i),
          placeId: uid(5, i % 20),
          userId: uid(2, Math.floor(i / 20) * 5 + (i % 5)),
          positive: i % 7 !== 0,
        })
        .onConflictDoNothing();
    for (let i = 0; i < 25; i++)
      await tx
        .insert(s.eventRSVP)
        .values({
          eventId: uid(6, i % 10),
          userId: uid(2, Math.floor(i / 10) * 3 + (i % 3)),
        })
        .onConflictDoNothing();
  });
  await pool.query(
    "UPDATE place SET category='Asian Grocery',category_id=$1 WHERE id=$2",
    [uid(3, 6), uid(5, 7)],
  );
  for (let i = 0; i < 10; i++)
    await pool.query("UPDATE product SET image=$1 WHERE id=$2", [
      `/demo/product-${i}.svg`,
      uid(7, i),
    ]);
  await ensureSystemLayers(pool, {
    id: uid(1, 1),
    slug: "houston",
    name: "Houston",
  });
  console.log(
    "Seeded Houston: 20 demo places, 10 events, 5 organizations, 10 products, 20 sightings, 15 users, 50 votes. Demo users cannot sign in.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
