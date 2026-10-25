package berlin.burgerbrothers.shell;

import java.net.URI;
import java.util.Locale;
import java.util.Set;
import java.util.Arrays;
import java.util.HashSet;

/** No Android dependencies: exercise URI handling with plain JVM tests. */
public final class NavigationPolicy {
    public enum Target { INTERNAL, EXTERNAL, BLOCKED }
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList("www.burger-brothers.berlin", "burger-brothers.berlin"));
    public static Target target(String value) {
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (scheme.equals("https")) {
                if (uri.getRawUserInfo() != null || uri.getHost() == null || uri.getHost().endsWith(".") || (uri.getPort() != -1 && uri.getPort() != 443)) return Target.BLOCKED;
                return HOSTS.contains(uri.getHost().toLowerCase(Locale.ROOT)) ? Target.INTERNAL : Target.EXTERNAL;
            }
            // External actions must be explicitly initiated by the user in MainActivity.
            if (scheme.equals("tel") || scheme.equals("mailto") || scheme.equals("geo")) return Target.EXTERNAL;
        } catch (Exception ignored) { }
        return Target.BLOCKED;
    }
    public static boolean trusted(String value) { return target(value) == Target.INTERNAL; }
    private NavigationPolicy() { }
}
