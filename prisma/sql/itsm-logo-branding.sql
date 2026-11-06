-- Logotipo enviado pelo administrador. Fica numa tabela própria (e não na linha de branding) para que as
-- consultas de branding, que rodam a cada carga do portal, nunca tragam os bytes da imagem.
CREATE TABLE IF NOT EXISTS logos_branding (
    id_cliente INT NOT NULL,
    tipo_mime VARCHAR(50) NOT NULL,
    conteudo BYTEA NOT NULL,
    tamanho_bytes INT NOT NULL,
    data_atualizacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_logos_branding PRIMARY KEY (id_cliente),
    CONSTRAINT fk_logo_cliente FOREIGN KEY (id_cliente) REFERENCES clientes (id) ON DELETE CASCADE
);
