import { singleton } from 'tsyringe';

const TTL_MS = 60 * 1000;

/**
 * Cache mémoire des TFM de projets résolus par solution (TTL 60 s). Évite de
 * reparser le fichier solution et de re-résoudre chaque .csproj pour CHAQUE
 * package interrogé (sinon O(packages × projets) de travail disque par vue).
 * TTL court car ces résolutions dépendent de fichiers pouvant changer entre
 * deux interrogations utilisateur. Les résolutions en échec ne sont jamais
 * mises en cache afin d'être retentées au prochain appel.
 *
 * Enregistré en singleton tsyringe : contrairement aux handlers (résolus
 * transitoirement à chaque requête via le conteneur), ce cache doit survivre
 * entre les requêtes pour être utile — d'où son extraction dans un service
 * injecté plutôt qu'un champ d'instance sur le handler.
 */
@singleton()
export class ProjectTfmCache {
  private readonly entries = new Map<string, { data: Map<string, string[]>; fetchedAt: number }>();

  public async getOrResolve(
    solutionPath: string,
    resolver: () => Promise<Map<string, string[]>>
  ): Promise<Map<string, string[]>> {
    const cached = this.entries.get(solutionPath);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.data;
    }

    const data = await resolver();
    this.entries.set(solutionPath, { data, fetchedAt: Date.now() });
    return data;
  }
}
