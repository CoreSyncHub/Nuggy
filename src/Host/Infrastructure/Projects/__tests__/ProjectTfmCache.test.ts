import { ProjectTfmCache } from '../ProjectTfmCache';

describe('ProjectTfmCache', () => {
  let cache: ProjectTfmCache;

  beforeEach(() => {
    cache = new ProjectTfmCache();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it('résout une seule fois pour deux lectures successives de la même solution', async () => {
    const resolver = jest.fn().mockResolvedValue(new Map([['/A.csproj', ['net8.0']]]));
    await cache.getOrResolve('/Solution/A.sln', resolver);
    await cache.getOrResolve('/Solution/A.sln', resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('résout séparément pour deux solutions distinctes', async () => {
    const resolver = jest.fn().mockResolvedValue(new Map());
    await cache.getOrResolve('/Solution/A.sln', resolver);
    await cache.getOrResolve('/Solution/B.sln', resolver);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('re-résout après expiration du TTL (60 s)', async () => {
    const resolver = jest.fn().mockResolvedValue(new Map());
    await cache.getOrResolve('/Solution/A.sln', resolver);

    (Date.now as jest.Mock).mockReturnValue(1_000_000 + 61 * 1000);
    await cache.getOrResolve('/Solution/A.sln', resolver);

    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('ne met pas en cache un resolver rejeté, et permet une nouvelle tentative', async () => {
    const resolver = jest.fn()
      .mockRejectedValueOnce(new Error('solution introuvable'))
      .mockResolvedValueOnce(new Map([['/A.csproj', ['net8.0']]]));

    await expect(cache.getOrResolve('/Solution/A.sln', resolver)).rejects.toThrow('solution introuvable');
    const data = await cache.getOrResolve('/Solution/A.sln', resolver);
    expect(data.get('/A.csproj')).toEqual(['net8.0']);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
