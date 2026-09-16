import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto.js';
import { users } from '../../common/mock-store.js';

@Injectable()
export class AuthService {
  login(dto: LoginDto) {
    const user = users.find((item) => item.email === dto.email);
    if (!user || dto.password !== '123456') {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    return {
      accessToken: `mock-token-${user.id}`,
      user,
    };
  }

  profile(userId = 'u-1') {
    return users.find((item) => item.id === userId) ?? users[0];
  }
}
