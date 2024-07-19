TamperDAV
=============

Um servidor semelhante ao WebDAV para sincronizar scripts do Tampermonkey e editá-los com um editor externo.

> **AVISO:** este não é um servidor 100% compatível com WebDAV. Muitos clientes devem, mas não necessariamente precisam funcionar!

# Uso

Certifique-se de que o [Node.js](https://nodejs.org/) maior que v4.9 esteja instalado.

## Windows

Dentro do diretório do projeto, execute ```TamperDAV.bat```

## Linux
Dentro do diretório do projeto, execute
``` sh
$ ./tamperdav.sh
```
## Clientes
[Tampermonkey (4.7.5823+)](https://www.tampermonkey.net/)
<img src="https://user-images.githubusercontent.com/767504/42598819-a1fb04a0-855d-11e8-8b42-a86abf577d82.png" alt="Configurações localhost Tampermonkey"></img> 

**Notas:**
> para permitir que o Tampermonkey use o conjunto completo de recursos do TamperDAV, certifique-se de que o TamperDAV esteja executando quando o Tampermonkey for iniciado.

> O Tampermonkey sincronizará todos os scripts em um subdiretório do diretório dav configurado.  por exemplo, `Tampermonkey/sync`, usando o UUID gerado internamente para o nome do arquivo. O arquivo real a ser editado pode ser facilmente encontrado executando `node find_script_in_meta.js --name="Nome do Meu Script"`. Alternativamente, você pode encontrar o UUID através da interface do usuário do Tampermonkey, navegando até o script e recuperando-o da barra de endereços conforme mostrado na imagem a seguir.

<img src="https://i.imgur.com/yvXBABL.png" alt="Obtendo o UUID do Script">

### Montagem
Comando Linux para montar o servidor WebDAV
``` sh
sudo mount -t davfs http://localhost:7000 /mnt
```

### Nautilus
Nautilus é o gerenciador de arquivos padrão do GNOME. Para acessar o servidor WebDAV, basta digitar o endereço `dav://localhost:7000/` na barra de endereços do Nautilus.

# Desenvolvimento

``` sh
# Instalar dependências
$ npm install

# Executar
$ mkdir dav
$ node server.js --path=dav/
```

# Configuração

Todas as opções podem ser definidas via config.json e/ou linha de comando. `username` e `password` também podem ser definidos via variáveis de ambiente.


### Exemplo de Linha de Comando
``` sh
$ node server.js --path=dav/ --port=7000 --username=admin --password=1234
```

### Exemplo de configurações do config.json
``` json
{
  "port": 7000,
  "path": "dav/",
  "username": "admin",
  "password": "1234"
}
```
###  Todas as Opções de Configuração
- `path` um caminho relativo de onde os arquivos devem ser servidos
- `no-auth-warning` não mostrar um aviso se nenhum nome de usuário e senha forem definidos
- `username` nome de usuário para autenticação (auth básica)
- `password` senha
- `port` porta TCP para escutar
- `host` endereço de rede para vincular
- `max-cursors` número de alterações armazenadas em cache
- `open-in-editor` se "true", então se Windows o editor "notepad" é usado, senão `xgd-open`; ou o executável como string, por exemplo, "gedit", "notepad", ...
- `meta-touch` tocar automaticamente no arquivo meta de uma entrada de sincronização para fazer o Tampermonkey iniciar uma sincronização nas alterações do script
- `no-dialog` Desabilita o uso de um diálogo para mostrar mensagens ao usuário
- `headless` Implica --no-dialog e desabilita a abertura do editor
- `debug` imprimir informações de depuração

---

# Licença

[MIT](./LICENSE)