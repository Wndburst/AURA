# ☠️ Desplegar en Oracle Cloud Always Free ☠️

Guía paso a paso para llevar **AURA FARM** desde tu PC hasta una VM gratis de Oracle. Es una
máquina pelada: no hay "deploy con un clic", pero son ~20 comandos y quedas al aire gratis
para siempre.

Repo: **https://github.com/Wndburst/AURA**

> **El gotcha de Oracle** que rompe el 90% de los primeros despliegues: hay que abrir el
> puerto **dos veces**. Una en la consola web (Security List) y otra **dentro de la propia
> VM** (su firewall interno, `iptables`, viene activo por defecto). Si solo haces la
> primera, la app "funciona" pero nadie de afuera puede entrar — está en el paso 2, no te
> lo saltes.

---

## 1. Crear la VM (Ampere A1, gratis para siempre)

En la consola de Oracle Cloud:

1. **Menú ☰ → Compute → Instances → Create Instance**.
2. **Name:** `aura-farm`.
3. **Image and shape:**
   - Click **Edit** junto a la imagen → **Canonical Ubuntu** → **24.04**.
   - Click **Edit** junto a shape → **Ampere** → **VM.Standard.A1.Flex**.
   - Configura **1 OCPU / 6 GB RAM** (la app usa ~96 MB con 300 personas encima; sobra por
     lejos, y dejas cupo del tier gratis libre para otra cosa el día de mañana).
4. **Networking:** deja la VCN que Oracle crea por default, con **"Assign a public IPv4
   address"** marcado.
5. **Add SSH keys:** elige **"Generate a key pair for me"** y **descarga la clave privada**
   (`ssh-key-....key`). Guárdala — es la única vez que Oracle te la muestra.
6. **Boot volume:** deja el default (50 GB alcanza de sobra).
7. **Create.**

Espera 1-2 minutos hasta que el estado pase a **Running**, y copia la **Public IP Address**
de la página de la instancia. La vas a necesitar el resto de la guía.

### Conectarte por SSH

Desde PowerShell, en la carpeta donde bajaste la clave:

```powershell
icacls .\ssh-key-XXXXXXX.key /inheritance:r
icacls .\ssh-key-XXXXXXX.key /grant:r "$($env:USERNAME):(R)"
ssh -i .\ssh-key-XXXXXXX.key ubuntu@<TU_IP_PÚBLICA>
```

Las dos líneas de `icacls` son porque Windows deja la clave con permisos demasiado abiertos
y SSH se niega a usarla si no las corriges. Di `yes` cuando pregunte por el fingerprint.

**Todo lo que sigue corre dentro de esa sesión SSH**, salvo que diga lo contrario.

---

## 2. Abrir los puertos (los dos lados)

### 2a. En la consola web (Security List)

1. **Menú ☰ → Networking → Virtual Cloud Networks** → entra a la VCN que se creó sola.
2. **Security Lists** → click en `Default Security List for <tu-vcn>`.
3. **Add Ingress Rules**, dos veces:
   - Source CIDR `0.0.0.0/0` · IP Protocol `TCP` · Destination Port Range `80`
   - Source CIDR `0.0.0.0/0` · IP Protocol `TCP` · Destination Port Range `443`

### 2b. Dentro de la VM (esto es lo que casi todos se saltan)

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Sin este paso, `curl localhost` funciona *adentro* de la VM pero nadie de afuera llega nunca
— la señal más confusa que hay, porque todo "parece" andar bien.

---

## 3. Instalar Docker

```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Cierra la sesión SSH y vuelve a entrar (`exit`, y el mismo `ssh` de arriba) para que el
permiso de grupo tome efecto. Verifica:

```bash
docker run hello-world
```

---

## 4. Clonar y levantar la app

```bash
git clone https://github.com/Wndburst/AURA.git aura-farm
cd aura-farm

cp .env.example .env
nano .env        # ajusta lo que quieras; con los defaults ya funciona bien
```

```bash
docker build -t aura-farm .
docker run -d \
  --name aura-farm \
  --restart unless-stopped \
  --init \
  -p 80:8080 \
  -v aura-data:/app/data \
  --env-file .env \
  -e PORT=8080 \
  aura-farm
```

El build tarda unos minutos la primera vez (está compilando el cliente y el servidor).
Verifica que esté vivo:

```bash
docker logs aura-farm
curl http://localhost/api/health
```

Deberías ver `{"ok":true,...}`. Y desde tu celular (con **datos móviles, no wifi**, para
probar de verdad que es público): `http://<TU_IP_PÚBLICA>` — esa es tu app, ya en internet.

---

## 5. (Opcional) Dominio propio + HTTPS

Si compraste un dominio, apunta un registro **A** a tu IP pública en tu proveedor de DNS.

Lo más simple para HTTPS es poner **Caddy** delante, que saca el certificado de Let's
Encrypt solo:

```bash
sudo mkdir -p /etc/caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
tu-dominio.cl {
    reverse_proxy localhost:80
}
EOF

docker run -d \
  --name caddy \
  --restart unless-stopped \
  -p 443:443 \
  -v caddy-data:/data \
  -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile \
  caddy:2-alpine
```

Sin dominio, `http://<TU_IP_PÚBLICA>` funciona perfecto para probar con el grupo — HTTPS
recién importa si vas a compartirlo más ampliamente (algunos navegadores avisan "sitio no
seguro" en `http://`, aunque la app funcione igual).

---

## 6. Actualizar la app después de un cambio

Desde tu PC: `git push`. Luego, en la VM:

```bash
cd aura-farm
git pull
docker build -t aura-farm .
docker stop aura-farm && docker rm aura-farm
docker run -d \
  --name aura-farm \
  --restart unless-stopped \
  --init \
  -p 80:8080 \
  -v aura-data:/app/data \
  --env-file .env \
  -e PORT=8080 \
  aura-farm
```

El volumen `aura-data` no se toca, así que el leaderboard sobrevive al redeploy.

---

## Si algo no anda

| Síntoma | Causa casi siempre |
|---|---|
| `curl localhost` funciona en la VM pero la IP pública no responde desde afuera | Falta el paso 2b (`iptables`) o el 2a (Security List) |
| `Permission denied (publickey)` al hacer SSH | Permisos de la clave en Windows — repite los `icacls` del paso 1 |
| `docker: permission denied` | No cerraste sesión después del `usermod -aG docker` (paso 3) |
| El contenedor arranca y muere al toque | `docker logs aura-farm` — casi siempre falta el `.env` o el puerto 80 ya está ocupado |
| La app anda pero el leaderboard se resetea cada vez que reinicias el contenedor | Falta el `-v aura-data:/app/data` en el `docker run` |
| El `git clone` pide usuario/contraseña | Si el repo es privado, necesitas un [Personal Access Token](https://github.com/settings/tokens) como contraseña |
