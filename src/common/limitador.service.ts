import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

type Janela = { n: number; ate: number };

/**
 * Limitador de taxa em memória, por chave (IP, e-mail...), em janela fixa. Vale por instância da API:
 * em várias réplicas o limite efetivo é multiplicado pelo número delas (bom o bastante contra força bruta).
 */
@Injectable()
export class LimitadorService {
  private readonly janelas = new Map<string, Janela>();

  /** Conta uma tentativa e lança 429 quando `maximo` é excedido dentro de `janelaMs`. */
  exigir(chave: string, maximo: number, janelaMs: number, mensagem = 'Muitas requisições. Aguarde um instante e tente novamente.') {
    const agora = Date.now();
    if (this.janelas.size > 10_000) {
      for (const [k, v] of this.janelas) if (v.ate < agora) this.janelas.delete(k);
    }
    const atual = this.janelas.get(chave);
    if (!atual || atual.ate < agora) {
      this.janelas.set(chave, { n: 1, ate: agora + janelaMs });
      return;
    }
    atual.n += 1;
    if (atual.n > maximo) throw new HttpException(mensagem, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Só confere: lança 429 se a chave já estourou o limite, sem contar esta chamada. */
  checar(chave: string, maximo: number, mensagem = 'Muitas tentativas. Aguarde um instante e tente novamente.') {
    const atual = this.janelas.get(chave);
    if (atual && atual.ate >= Date.now() && atual.n >= maximo) throw new HttpException(mensagem, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Conta uma falha. Usado com `checar` para limitar só as tentativas que erram (logins bem-sucedidos não pesam). */
  falhar(chave: string, janelaMs: number) {
    const agora = Date.now();
    const atual = this.janelas.get(chave);
    if (!atual || atual.ate < agora) this.janelas.set(chave, { n: 1, ate: agora + janelaMs });
    else atual.n += 1;
  }

  /** Zera a contagem (ex.: após um login bem-sucedido). */
  limpar(chave: string) {
    this.janelas.delete(chave);
  }
}
