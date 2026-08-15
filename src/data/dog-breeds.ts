export interface DogBreedOption {
  value: string;
  aliases: string[];
}

export const DOG_BREEDS: DogBreedOption[] = [
  { value: '德国牧羊犬', aliases: ['德牧', 'german shepherd'] },
  { value: '拉布拉多寻回犬', aliases: ['拉布拉多', 'labrador'] },
  { value: '金毛寻回犬', aliases: ['金毛', 'golden retriever'] },
  { value: '边境牧羊犬', aliases: ['边牧', 'border collie'] },
  { value: '威尔士柯基犬', aliases: ['柯基', 'corgi'] },
  { value: '贵宾犬', aliases: ['泰迪', 'poodle'] },
  { value: '比熊犬', aliases: ['比熊', 'bichon frise'] },
  { value: '博美犬', aliases: ['博美', 'pomeranian'] },
  { value: '西伯利亚哈士奇', aliases: ['哈士奇', 'husky'] },
  { value: '萨摩耶犬', aliases: ['萨摩耶', 'samoyed'] },
  { value: '阿拉斯加雪橇犬', aliases: ['阿拉斯加', 'alaskan malamute'] },
  { value: '柴犬', aliases: ['shiba inu'] },
  { value: '秋田犬', aliases: ['akita'] },
  { value: '法国斗牛犬', aliases: ['法斗', 'french bulldog'] },
  { value: '英国斗牛犬', aliases: ['英斗', 'english bulldog'] },
  { value: '巴哥犬', aliases: ['八哥', 'pug'] },
  { value: '吉娃娃', aliases: ['chihuahua'] },
  { value: '约克夏梗', aliases: ['约克夏', 'yorkshire terrier'] },
  { value: '雪纳瑞', aliases: ['schnauzer'] },
  { value: '西高地白梗', aliases: ['西高地', 'west highland white terrier'] },
  { value: '腊肠犬', aliases: ['dachshund'] },
  { value: '杜宾犬', aliases: ['杜宾', 'doberman'] },
  { value: '罗威纳犬', aliases: ['罗威纳', 'rottweiler'] },
  { value: '比利时马里努阿犬', aliases: ['马犬', 'malinois'] },
  { value: '喜乐蒂牧羊犬', aliases: ['喜乐蒂', 'shetland sheepdog'] },
  { value: '松狮犬', aliases: ['松狮', 'chow chow'] },
  { value: '蝴蝶犬', aliases: ['papillon'] },
  { value: '北京犬', aliases: ['京巴', 'pekingese'] },
  { value: '可卡犬', aliases: ['可卡', 'cocker spaniel'] },
  { value: '比格犬', aliases: ['比格', 'beagle'] },
  { value: '杰克罗素梗', aliases: ['杰克罗素', 'jack russell terrier'] },
  { value: '大丹犬', aliases: ['大丹', 'great dane'] },
  { value: '圣伯纳犬', aliases: ['圣伯纳', 'saint bernard'] },
  { value: '伯恩山犬', aliases: ['伯恩山', 'bernese mountain dog'] },
  { value: '纽芬兰犬', aliases: ['纽芬兰', 'newfoundland'] },
  { value: '灵缇犬', aliases: ['灵缇', 'greyhound'] },
  { value: '中华田园犬', aliases: ['田园犬', '土狗', 'chinese rural dog'] },
  { value: '混种犬', aliases: ['串串', '混血', 'mixed breed'] },
];

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '');
}

export function filterDogBreeds(query: string): DogBreedOption[] {
  const keyword = normalize(query.trim());
  if (!keyword) return DOG_BREEDS;
  return DOG_BREEDS.filter((breed) =>
    [breed.value, ...breed.aliases].some((candidate) => normalize(candidate).includes(keyword)),
  );
}
